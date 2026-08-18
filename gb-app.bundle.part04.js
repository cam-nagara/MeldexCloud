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

// 起動時に正本「スタッフ管理シート」へ自分の行を fill-only 登録する
// （ユーザーアカウント一元管理 計画書 Phase 2、§5.6）。行が既に存在するなら
// 一切上書きしない（管理者がシートで編集した値は同期に負けない契約）。
// 正本シート自体が未設定の場合はここで無ダイアログ自動作成される
// （計画書§5.1「起動時同期」が自動作成のトリガーの一つ）。
async function _primeStaffRegistrySelfUpsert() {
  if (!window.MeldexUserRegistry) return;
  const me = typeof getUsername === 'function' ? String(getUsername() || '').trim() : '';
  if (!me || me === 'anonymous') return;
  try {
    await window.MeldexUserRegistry.upsertStaff({ user: me, display: me }, { fillOnly: true });
  } catch (e) {
    // ソースフォルダ未設定・オフライン等では起動処理を止めない。
  }
}

async function init() {
  const initStartedAt = typeof _perfNowMs === 'function' ? _perfNowMs() : Date.now();
  // チームプロフィール同期は権限情報の更新用途。起動表示は待たず、裏で完了させる。
  _runStartupBackground('team-profile-sync', _syncMyTeamProfile());
  _runStartupBackground('staff-registry-self-upsert', _primeStaffRegistrySelfUpsert());

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
    window.MeldexRegisteredSourceRoots = Array.isArray(roots)
      ? roots.filter(root => root?.path).map(root => ({ ...root }))
      : [];
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
    if (!vault.path && !hasRoots && !hasHome) {
      // ソースフォルダもルートもホームもない場合はウェルカム画面
      // ただしサイドバーは表示したまま（設定ボタンにアクセスできるように）
      showView('welcome');
    }

    // ホームフォルダの版間共有: 起動時の共有警告・引き継ぎ提案チェック。
    // オンボーディングウィザードが出る場合はダイアログの重なりを避けて後回しにする
    // （設定画面を開いた時に loadHomeFolderSharingStatusForSettings() 経由で再チェックされる）。
    if (!onboardingShown && window.MeldexHomeFolderSharing?.loadHomeFolderSharingStatusForSettings) {
      _runStartupBackground(
        'home-folder-sharing-check',
        window.MeldexHomeFolderSharing.loadHomeFolderSharingStatusForSettings()
      );
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
  const isDbViewName = (name) => ['pivot', 'tree', 'gallery', 'kanban', 'timeline', 'chart', 'graph', 'form', 'smart-db', 'calendar', 'tasks', 'shifts'].includes(name);
  // スプリットペイン内のビュー切替（ctxにcontainerElがある場合）
  if (ctx && ctx.containerEl) {
    const isDbView = isDbViewName(viewName);
    const c = ctx.containerEl;
    const hasPaneViewSurfaces = !!c.querySelector('#pivot-view, #tree-view, #gallery-view, #kanban-view, #timeline-view, #chart-view, #graph-view, #form-view, #smart-db-view, .pivot-view, .tree-view, .gallery-view, .kanban-view, .timeline-view, .chart-view, .graph-view, .form-view, .smart-db-view');
    if (hasPaneViewSurfaces) {
      const _sv = (sel, show) => { const el = c.querySelector(sel); if (el) el.style.display = show; };
      _sv('#db-view-container, .db-view-container', isDbView ? 'flex' : 'none');
      _sv('#pivot-view, .pivot-view', resolvedViewName === 'pivot' ? '' : 'none');
      _sv('#tree-view, .tree-view', resolvedViewName === 'tree' ? 'flex' : 'none');
      _sv('#gallery-view, .gallery-view', resolvedViewName === 'gallery' ? 'flex' : 'none');
      _sv('#kanban-view, .kanban-view', resolvedViewName === 'kanban' ? 'flex' : 'none');
      _sv('#timeline-view, .timeline-view', resolvedViewName === 'timeline' ? '' : 'none');
      _sv('#chart-view, .chart-view', resolvedViewName === 'chart' ? 'flex' : 'none');
      _sv('#graph-view, .graph-view', resolvedViewName === 'graph' ? 'flex' : 'none');
      _sv('#form-view, .form-view', resolvedViewName === 'form' ? 'flex' : 'none');
      _sv('#smart-db-view, .smart-db-view', resolvedViewName === 'smart-db' ? '' : 'none');
      ctx.viewMode = viewName;
      if (typeof _dbTreeSetOptionTabVisible === 'function') {
        _dbTreeSetOptionTabVisible(resolvedViewName === 'tree', ctx);
      }
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
  _setDisplay('tree-view', resolvedViewName === 'tree' ? 'flex' : 'none');
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
  if (typeof _dbTreeSetOptionTabVisible === 'function') {
    _dbTreeSetOptionTabVisible(resolvedViewName === 'tree');
  }
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
    const csvSheetActive = typeof isCsvSheetModeActive === 'function' && isCsvSheetModeActive();
    if (csvSheetActive && typeof updateCsvShortcutStatusbar === 'function') updateCsvShortcutStatusbar(sc);
    else if (typeof updateDatabaseShortcutStatusbar === 'function') updateDatabaseShortcutStatusbar(sc);
    else sc.textContent = '';
  } else if (resolvedViewName === 'entity' || resolvedViewName === 'page') {
    sc.textContent = 'Ctrl+B 太字 | Ctrl+I 斜体 | Ctrl+U 下線 | Ctrl+Shift+1~6 見出し | Ctrl+Shift+8 箇条書き | Tab インデント | Ctrl+Shift+↑↓ 移動';
  } else if (resolvedViewName === 'scriptnote') {
    if (typeof updateScriptnoteShortcutStatusbar === 'function') updateScriptnoteShortcutStatusbar(sc);
    else sc.textContent = 'Enter 行追加 | Ctrl+Enter 同タイプ行追加 | Shift+Del 行削除 | Tab タイプ選択 | Ctrl+↑↓ 行移動 | Ctrl+R ルビ | Ctrl+Z Undo | Ctrl+Y Redo';
  } else if (resolvedViewName === 'media') {
    if (typeof updateMediaViewerShortcutStatusbar === 'function') updateMediaViewerShortcutStatusbar(sc);
    else sc.textContent = '';
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
      items[(index + delta + items.length) % items.length]?.focus();
    } else if (ev.key === 'Home') {
      ev.preventDefault();
      items[0]?.focus();
    } else if (ev.key === 'End') {
      ev.preventDefault();
      items.at(-1)?.focus();
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      closeMenu(true);
    }
  });
  pointerCloser = (ev) => {
    if (!menu.contains(ev.target) && !btn?.contains?.(ev.target)) closeMenu(false);
  };
  keyCloser = (ev) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      closeMenu(true);
    }
  };
  document.addEventListener('pointerdown', pointerCloser, true);
  document.addEventListener('keydown', keyCloser, true);
  requestAnimationFrame(() => menu.querySelector('.ab-dropdown-item')?.focus());
}

function _screenshotModeIsRegion(mode) {
  return String(mode || '').includes('region');
}

async function _setMeldexWindowVisibilityForScreenshot(action, hwnds) {
  if (window.MeldexRuntimeAdapter?.isBrowserDataMode?.()) return null;
  try {
    const res = await fetch(API_BASE + '/app-window-visibility', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, hwnds: hwnds || [] }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function _hideMeldexWindowForScreenshot() {
  const state = await _setMeldexWindowVisibilityForScreenshot('hide');
  if (!state?.hidden) window.blur();
  await new Promise(r => setTimeout(r, 500));
  return state;
}

async function _restoreMeldexWindowForScreenshot(state) {
  if (state?.hidden) await _setMeldexWindowVisibilityForScreenshot('restore', state.hwnds || []);
  else window.focus();
}

function _cropScreenshotCanvas(canvas, region) {
  const cropped = document.createElement('canvas');
  cropped.width = Math.max(1, Math.round(region.width));
  cropped.height = Math.max(1, Math.round(region.height));
  cropped.getContext('2d').drawImage(
    canvas,
    Math.round(region.x),
    Math.round(region.y),
    cropped.width,
    cropped.height,
    0,
    0,
    cropped.width,
    cropped.height
  );
  return cropped;
}

function _selectScreenshotRegionFromCanvas(canvas) {
  return new Promise(resolve => {
    if (typeof window.GBUI?.createModal !== 'function') {
      resolve(null);
      return;
    }
    const restoreFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const stage = document.createElement('div');
    stage.className = 'screenshot-region-stage';
    stage.dataset.e2eId = 'screenshot-region-stage';
    stage.tabIndex = 0;
    stage.setAttribute('role', 'group');
    stage.setAttribute('aria-label', '保存する範囲');

    const preview = document.createElement('canvas');
    preview.className = 'screenshot-region-preview';
    preview.setAttribute('aria-hidden', 'true');
    preview.width = canvas.width;
    preview.height = canvas.height;
    preview.getContext('2d').drawImage(canvas, 0, 0);
    const maxW = Math.max(1, Math.floor(window.innerWidth * 0.94));
    const maxH = Math.max(1, Math.floor(window.innerHeight * 0.82));
    const scale = Math.min(maxW / canvas.width, maxH / canvas.height, 1);
    preview.style.width = Math.max(1, Math.round(canvas.width * scale)) + 'px';
    preview.style.height = Math.max(1, Math.round(canvas.height * scale)) + 'px';

    const selection = document.createElement('div');
    selection.className = 'screenshot-region-selection';
    selection.setAttribute('aria-hidden', 'true');
    selection.style.display = 'none';

    const actions = document.createElement('div');
    actions.className = 'screenshot-region-actions';
    actions.style.width = '100%';
    actions.style.minWidth = '0';
    actions.setAttribute('aria-label', '範囲選択の操作');

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'gb-btn gb-btn-sm';
    cancel.style.flex = '0.8 1 0';
    cancel.dataset.e2eId = 'screenshot-region-cancel';
    cancel.textContent = 'キャンセル';

    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'gb-btn gb-btn-sm gb-btn-primary';
    ok.style.flex = '1.5 1 0';
    ok.style.minWidth = '0';
    ok.dataset.e2eId = 'screenshot-region-save';
    ok.textContent = 'スクリーンショット撮影';

    stage.append(preview, selection);
    actions.append(cancel, ok);

    let start = null;
    let current = null;
    let activePointerId = null;
    let cleaned = false;
    let result = null;
    let modalApi = null;

    const cleanup = (value, reason = 'programmatic') => {
      if (cleaned) return;
      result = value;
      modalApi.close(reason);
    };
    const pointFromEvent = (ev) => {
      const rect = preview.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(rect.width, ev.clientX - rect.left)),
        y: Math.max(0, Math.min(rect.height, ev.clientY - rect.top)),
        rect,
      };
    };
    const visibleRect = () => {
      if (!start || !current) return null;
      const left = Math.min(start.x, current.x);
      const top = Math.min(start.y, current.y);
      const width = Math.abs(current.x - start.x);
      const height = Math.abs(current.y - start.y);
      return { left, top, width, height };
    };
    const updateSelection = () => {
      const rect = visibleRect();
      if (!rect || rect.width < 1 || rect.height < 1) {
        selection.style.display = 'none';
        return;
      }
      selection.style.display = 'block';
      selection.style.left = rect.left + 'px';
      selection.style.top = rect.top + 'px';
      selection.style.width = rect.width + 'px';
      selection.style.height = rect.height + 'px';
    };
    const canvasRegion = () => {
      const rect = visibleRect();
      if (!rect || rect.width < 4 || rect.height < 4) return null;
      const bounds = preview.getBoundingClientRect();
      const scaleX = canvas.width / bounds.width;
      const scaleY = canvas.height / bounds.height;
      const x = Math.max(0, Math.min(canvas.width - 1, rect.left * scaleX));
      const y = Math.max(0, Math.min(canvas.height - 1, rect.top * scaleY));
      return {
        x,
        y,
        width: Math.max(1, Math.min(canvas.width - x, rect.width * scaleX)),
        height: Math.max(1, Math.min(canvas.height - y, rect.height * scaleY)),
      };
    };
    function onKeyDown(ev) {
      if (ev.key === 'Enter') {
        const region = canvasRegion();
        if (region) cleanup(region, 'submit');
      }
    }
    stage.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      stage.focus?.();
      activePointerId = ev.pointerId;
      try { stage.setPointerCapture?.(ev.pointerId); } catch {}
      start = pointFromEvent(ev);
      current = start;
      updateSelection();
    });
    stage.addEventListener('pointermove', (ev) => {
      if (activePointerId == null || ev.pointerId !== activePointerId) return;
      current = pointFromEvent(ev);
      updateSelection();
    });
    stage.addEventListener('pointerup', (ev) => {
      if (activePointerId == null || ev.pointerId !== activePointerId) return;
      current = pointFromEvent(ev);
      try { stage.releasePointerCapture?.(ev.pointerId); } catch {}
      activePointerId = null;
      updateSelection();
    });
    stage.addEventListener('pointercancel', (ev) => {
      if (activePointerId != null && ev.pointerId === activePointerId) activePointerId = null;
    });
    cancel.addEventListener('click', () => cleanup(null, 'cancel'));
    ok.addEventListener('click', () => {
      const region = canvasRegion();
      if (!region) {
        showStatus('範囲を選択してください', true);
        return;
      }
      cleanup(region, 'submit');
    });
    document.addEventListener('keydown', onKeyDown);
    modalApi = window.GBUI.createModal({
      id: 'screenshot-region-selector',
      title: 'スクリーンショット撮影対象を選択',
      body: stage,
      footer: actions,
      variant: 'full-bleed',
      extraClass: 'screenshot-region-shell',
      geometryKey: 'screenshot-region-selector',
      minWidth: '0',
      initialFocus: stage,
      returnFocus: restoreFocusTo || undefined,
      closeLabel: '範囲選択を閉じる',
      closeOnEsc: true,
      closeOnOverlay: true,
      onClose: () => {
        if (cleaned) return;
        cleaned = true;
        document.removeEventListener('keydown', onKeyDown);
        resolve(result);
      },
    });
    const overlay = modalApi.overlay;
    overlay.classList.add('modal-overlay', 'screenshot-region-overlay');
    overlay.dataset.e2eId = 'screenshot-region-overlay';
    overlay.style.zIndex = '5000';
    overlay._screenshotRegionModalApi = modalApi;
    modalApi.modal.dataset.e2eId = 'screenshot-region-shell';
    modalApi.footer.classList.add('screenshot-region-actions');
    modalApi.open();
  });
}

async function captureScreenshot(mode) {
  let stream = null;
  let hideState = null;
  try {
    const hideFirst = mode.includes('hide');
    if (hideFirst) hideState = await _hideMeldexWindowForScreenshot();
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'monitor' } });
    const video = document.createElement('video');
    const loaded = new Promise((resolve, reject) => {
      video.onloadeddata = resolve;
      video.onerror = () => reject(new Error('画面キャプチャ映像を読み込めませんでした'));
    });
    video.srcObject = stream;
    await video.play();
    await loaded;
    await new Promise(r => setTimeout(r, 200));
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    stream.getTracks().forEach(t => t.stop());
    stream = null;
    if (hideFirst) {
      await _restoreMeldexWindowForScreenshot(hideState);
      hideState = null;
    }
    let outputCanvas = canvas;
    if (_screenshotModeIsRegion(mode)) {
      const region = await _selectScreenshotRegionFromCanvas(canvas);
      if (!region) return;
      outputCanvas = _cropScreenshotCanvas(canvas, region);
    }
    const b64 = outputCanvas.toDataURL('image/png');
    const screenshotHome = ((typeof _homeFolderPath !== 'undefined' ? _homeFolderPath : '') || '').replace(/[\\/]$/, '');
    const defaultScreenshotFolder = screenshotHome ? screenshotHome + '/スクリーンショット' : 'スクリーンショット';
    const screenshotFolder = localStorage.getItem('meldex-screenshot-folder') || defaultScreenshotFolder;
    const currentTarget = (typeof getAnnotationTarget === 'function' ? getAnnotationTarget() : (typeof currentFilePath !== 'undefined' ? currentFilePath : '')) || '';
    const res = await apiPost('/annotation/screenshot', {
      data: b64,
      target_path: screenshotFolder,
      source_target: currentTarget,
      mode: mode,
      width: outputCanvas.width,
      height: outputCanvas.height,
    });
    if (res.path) {
      if (typeof loadRpAnnotationList === 'function') loadRpAnnotationList();
      showStatus('スクリーンショットを保存しました', false, { showSaveDialog: true });
    }
  } catch (e) {
    if (e.name !== 'NotAllowedError') showStatus('スクリーンショット失敗: ' + e.message, true);
  } finally {
    if (stream) stream.getTracks().forEach(t => t.stop());
    if (hideState) await _restoreMeldexWindowForScreenshot(hideState);
  }
}
