/**
 * Meldex Database Views
 * DB/ピボット/ギャラリー/カンバン/タイムライン、数式、インライン編集
 */
/* 共通 helper は gb-db-core.js に分離 */

/* ==============================
   DB選択・エントリ選択
   ============================== */
// レイアウトツリー（GBLayout.root）には載らないが、正当な描画先である面かどうか。
// 埋め込みシート（制作管理）と右サイドバーのサブパネルが該当する。ここを1つの判定に
// まとめておかないと、3つ目の面が増えたときに「描画先が勝手にメインパネルへ
// 差し替わる」同じ事故が再発する（ボードのリンクカード計画 2026-08-13 Phase B-1）。
function _dbIsOffTreeRenderSurface(ctx) {
  if (!ctx) return false;
  if (ctx.embedded) return true;
  if (ctx.surface === 'subpanel') return true;
  if (!ctx.paneId || typeof GBLayout === 'undefined') return false;
  return GBLayout.paneMap?.[ctx.paneId]?.surface === 'subpanel';
}

function _resolveDatabasePaneContext(ctx, options) {
  const resolveOpts = options || {};
  const explicitCtx = !!ctx;
  if (explicitCtx && ctx.embedded
    && (ctx.destroyed || !ctx.containerEl)) {
    return null;
  }
  if (explicitCtx && ctx.embedded) {
    return ctx;
  }
  let candidate = ctx || _currentPaneState();
  const containerDetached = !!(candidate?.containerEl && !document.body.contains(candidate.containerEl));
  // 埋め込みシート（MeldexProductionSheetEmbed 等）は GBLayout のレイアウトツリーへ
  // 意図的に未登録の専用 ctx を使う（グローバル副作用ゼロの設計）。そのため paneId は
  // 常に findNode で見つからず、以下の paneMissing 判定だけに頼ると埋め込み側の ctx が
  // 毎回メイン画面側の「現在アクティブなペイン」の ctx へ差し替えられ、描画先とデータ
  // 格納先がすれ違う（P0バグ）。ctx.embedded フラグが立っており、かつ containerEl が
  // document に接続されている間はこの差し替えをスキップする。containerEl が切断された
  // 場合（destroy 後の取り違え等）は従来どおり安全側（メイン画面ctx）へフォールバックする。
  // 埋め込みシートに加えて、右サイドバーのサブパネルも「ツリー外だが正当な描画先」
  // として扱う（Phase B-1）。containerEl が document から切り離された場合に安全側
  // （メイン画面ctx）へ戻す既存の挙動はそのまま残す。
  const isConnectedOffTreeCtx = !!(_dbIsOffTreeRenderSurface(candidate) && !containerDetached);
  const paneMissing = !isConnectedOffTreeCtx && !!(candidate?.paneId && typeof GBLayout !== 'undefined' && typeof GBLayout.findNode === 'function' && !GBLayout.findNode(GBLayout.root, candidate.paneId)?.node);
  const shouldUseActivePane = !isConnectedOffTreeCtx && !!resolveOpts.preferActivePane && !!candidate?.paneId && typeof GBLayout !== 'undefined' && !!GBLayout.activePane && candidate.paneId !== GBLayout.activePane;
  if (paneMissing || containerDetached || shouldUseActivePane) candidate = _currentPaneState();
  if (!explicitCtx && candidate?.containerEl && !_dbPaneHasPivotTable(candidate) && typeof _globalPaneState === 'function') {
    candidate = _globalPaneState();
  }
  return candidate;
}

function _dbPaneHasPivotTable(ctx) {
  if (!ctx?.containerEl) return true;
  if (typeof ctx.containerEl.querySelector !== 'function') return true;
  const tblId = ctx.tableId || 'pivot-table';
  try {
    const id = MeldexEscape.cssIdent(tblId);
    return !!ctx.containerEl.querySelector('#' + id);
  } catch {
    return false;
  }
}

function _normalizeDbRenderContext(ctx) {
  const candidate = ctx || _currentPaneState();
  // 埋め込みシートはカレンダー面などへ切り替えている間、一時的に document から
  // detach される。その間も明示的に渡された専用 ctx と専用 table が生存していれば
  // detached DOM へ描画してよい。destroy() は destroyed=true と table の破棄で判定する。
  if (ctx?.embedded && (ctx.destroyed || !ctx.containerEl)) return null;
  if (ctx?.embedded && !_dbPaneHasPivotTable(ctx)) return null;
  if (candidate?.containerEl && !_dbPaneHasPivotTable(candidate) && typeof _globalPaneState === 'function') {
    return ctx ? null : _globalPaneState();
  }
  return candidate;
}

function _renderDbViewTabsSafely(ctx) {
  if (typeof renderDbViewTabs !== 'function') return;
  try {
    renderDbViewTabs(ctx);
  } catch (error) {
    console.warn('[Meldex] シートビュータブの描画に失敗しました。シート本体の読み込みは続行します。', error);
  }
}

function _restoreDbViewScrollState(ctx, viewMode, scrollState) {
  if (!scrollState) return;
  // rAF単独待ちだと、フレームが生成されない状況（バックグラウンドタブ、
  // ヘッドレス実行等）で復元が一度も走らない。_nextFrame と同じ
  // 「rAF or タイムアウト」の競争で必ず1回だけ適用する。
  let applied = false;
  const apply = () => {
    if (applied) return;
    applied = true;
    const container = typeof _getDbViewScrollContainer === 'function'
      ? _getDbViewScrollContainer(ctx, viewMode)
      : null;
    if (!container) return;
    if (Number.isFinite(scrollState.scrollLeft)) container.scrollLeft = scrollState.scrollLeft;
    if (Number.isFinite(scrollState.scrollTop)) container.scrollTop = scrollState.scrollTop;
    const focusedEntity = String(scrollState.focusedEntity || '').trim();
    if (!focusedEntity) return;
    const escaped = MeldexEscape.cssIdent(focusedEntity);
    const target = container.querySelector(`[data-entity-name="${escaped}"], [data-entity="${escaped}"]`);
    if (!target) return;
    target.classList.add('db-view-focused-entity');
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    setTimeout(() => target.classList.remove('db-view-focused-entity'), 1600);
  };
  requestAnimationFrame(apply);
  setTimeout(apply, 120);
}

function _restoreDbNavigationViewSnapshot(dbPath, snapshot) {
  if (!snapshot?.savedView || !Number.isInteger(snapshot.viewIdx)) return false;
  const cfg = getDbViewConfig(dbPath);
  if (!Array.isArray(cfg.savedViews) || snapshot.viewIdx < 0 || snapshot.viewIdx >= cfg.savedViews.length) return false;
  try {
    cfg.savedViews[snapshot.viewIdx] = JSON.parse(JSON.stringify(snapshot.savedView));
  } catch {
    return false;
  }
  cfg.currentViewIdx = snapshot.viewIdx;
  saveDbViewConfig(dbPath, cfg, { skipHistory: true, skipBackend: true });
  return true;
}

function _renderDbLoadError(ctx, error) {
  ctx = _normalizeDbRenderContext(ctx);
  if (!ctx) return;
  clearPivot(ctx);
  const message = 'シートを読み込めませんでした: ' + (error?.message || error || '不明なエラー');
  const safeMessage = MeldexEscape.html(message);
  const tblId = ctx?.tableId || 'pivot-table';
  const tbody = _paneEl(ctx, '#' + tblId + ' tbody');
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="999" style="padding:24px;color:var(--fg2);">${safeMessage}</td></tr>`;
  }
  const errorHtml = `<div class="db-load-error" role="alert" style="padding:40px;text-align:center;color:var(--fg2);">${safeMessage}</div>`;
  ['.tree-view', '.gallery-view', '.kanban-view', '.timeline-view', '.chart-view', '.graph-view', '.form-view'].forEach(selector => {
    const container = _paneEl(ctx, selector);
    if (container) container.innerHTML = errorHtml;
  });
}

function _isBackendDbViewConfigObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function _hasBackendDbViewConfigData(value) {
  return _isBackendDbViewConfigObject(value) && Object.keys(value).length > 0;
}

function _normalizeBackendDbViewConfig(dbPath, viewConfig) {
  if (!_isBackendDbViewConfigObject(viewConfig)) return null;
  const cloned = typeof _cloneDbViewObject === 'function'
    ? _cloneDbViewObject(viewConfig)
    : JSON.parse(JSON.stringify(viewConfig || {}));
  if (typeof _migrateLegacyViewConfig === 'function') {
    const migrated = _migrateLegacyViewConfig(dbPath, cloned);
    const normalized = migrated.cfg || cloned;
    const productionRepaired = typeof repairProductionManagementDbViewConfig === 'function'
      && repairProductionManagementDbViewConfig(dbPath, normalized);
    return { cfg: normalized, changed: migrated.changed === true || productionRepaired };
  }
  const productionRepaired = typeof repairProductionManagementDbViewConfig === 'function'
    && repairProductionManagementDbViewConfig(dbPath, cloned);
  return { cfg: cloned, changed: productionRepaired };
}

function _applyBackendDbViewConfig(dbPath, viewConfig, ctx) {
  const normalizedResult = _normalizeBackendDbViewConfig(dbPath, viewConfig);
  if (!normalizedResult) return false;
  if (typeof _hasPendingDbViewConfigBackendSave === 'function' && _hasPendingDbViewConfigBackendSave(dbPath)) return false;
  const normalized = normalizedResult.cfg || {};
  const current = typeof getDbViewConfig === 'function' ? (getDbViewConfig(dbPath) || {}) : {};
  let changed = false;
  try { changed = JSON.stringify(current || {}) !== JSON.stringify(normalized || {}); } catch { changed = true; }
  if (typeof saveDbViewConfig === 'function') {
    saveDbViewConfig(dbPath, normalized, { skipHistory: true, skipBackend: true });
  } else if (typeof localStorage !== 'undefined') {
    localStorage.setItem('dbViewConfig:' + (dbPath || ''), JSON.stringify(normalized));
  }
  if (normalizedResult.changed && typeof _persistDbViewConfigToBackend === 'function') {
    _persistDbViewConfigToBackend(dbPath, normalized, { ctx });
  }
  return changed;
}

async function _migrateDbViewConfigToBackend(dbPath, options = {}) {
  if (!dbPath || typeof getDbViewConfig !== 'function' || typeof apiPut !== 'function') return null;
  if (typeof isProductionManagementWriteBlocked === 'function'
      && isProductionManagementWriteBlocked(dbPath, options.ctx)) return null;
  if (options.requireExistingLocalCache === true && options.hadLocalCache !== true) return null;
  const localConfig = getDbViewConfig(dbPath) || {};
  const payload = typeof _sanitizeDbViewConfigForBackend === 'function'
    ? _sanitizeDbViewConfigForBackend(localConfig)
    : localConfig;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length === 0) return null;
  try {
    await apiPut('/db-metadata?path=' + encodeURIComponent(dbPath), { view_config: payload });
    return payload;
  } catch (error) {
    console.warn('[Meldex] シート表示設定の移行に失敗しました', error);
    return null;
  }
}

async function selectDatabase(dbPath, ctx, opts) {
  const openOpts = opts || {};
  const requestedViewMode = ['pivot', 'tree', 'gallery', 'kanban', 'timeline', 'chart', 'graph', 'form']
    .includes(String(openOpts.requestedViewMode || '').trim())
    ? String(openOpts.requestedViewMode).trim()
    : '';
  const dbPerfStartedAt = typeof _perfNowMs === 'function' ? _perfNowMs() : Date.now();
  const dbPerfTargetLabel = String(dbPath || '').split(/[\\/]/).filter(Boolean).pop() || String(dbPath || '');
  ctx = _resolveDatabasePaneContext(ctx);
  if (!ctx) return { ok: false, destroyed: true };
  if (ctx.embedded && ctx.hostController && openOpts.embeddedHostDispatch !== true) {
    const opened = await ctx.hostController.open(dbPath, { ...openOpts, forceReload: true });
    return { ok: opened !== false, stale: opened === false, destroyed: !!ctx.destroyed, dbPath };
  }
  const syncGlobalState = !ctx.embedded && openOpts.skipGlobalState !== true;
  const isolatedContext = !!ctx.embedded;
  const loadGeneration = ctx.generation || 0;
  const previousContext = {
    dbPath: ctx.dbPath,
    entityPath: ctx.entityPath,
    pivotData: ctx.pivotData,
    dbMetadata: ctx.dbMetadata,
    viewMode: ctx.viewMode,
  };
  const previousGlobal = syncGlobalState ? {
    currentDbPath: state.currentDbPath,
    currentEntityPath: state.currentEntityPath,
    currentSmartDb: state.currentSmartDb,
    smartDbData: state.smartDbData,
    pivotData: state.pivotData,
    dbMetadata: state.dbMetadata,
    filter: state.filter,
  } : null;
  const inFlightLoad = ctx?._selectDatabaseInFlight;
  if (!openOpts.forceReload && inFlightLoad && inFlightLoad.dbPath === dbPath && inFlightLoad.promise) {
    if (typeof _logPerfEvent === 'function') {
      _logPerfEvent('sheet.selectDatabase.coalesced', dbPerfStartedAt, {
        targetLabel: dbPerfTargetLabel,
        paneId: ctx?.paneId || '',
      });
    }
    return inFlightLoad.promise;
  }
  let resolveInFlightLoad = null;
  let finalLoadResult = null;
  const completeLoad = result => {
    finalLoadResult = result;
    return result;
  };
  const inFlightPromise = new Promise(resolve => { resolveInFlightLoad = resolve; });
  if (ctx) ctx._selectDatabaseInFlight = { dbPath, promise: inFlightPromise };
  if (!isolatedContext && !openOpts.skipShowView && typeof deactivateCsvSheetMode === 'function') deactivateCsvSheetMode();
  const showOpenLoading = !openOpts.silent
    && !openOpts.skipGlobalUi
    && typeof showLoading === 'function'
    && typeof hideLoading === 'function';
  let loadingShown = false;
  try {
    if (showOpenLoading) { showLoading('シートを読み込み中...'); loadingShown = true; }
    const _isDbSwitch = (syncGlobalState ? state.currentDbPath : ctx.dbPath) !== dbPath;
    // 別DBへの切替時は一括編集バーを閉じる + 選択 Set をクリア (D-5)
    if (_isDbSwitch) {
      const _ctxClear = ctx || _currentPaneState();
      if (_ctxClear && _ctxClear._selectedEntities) _ctxClear._selectedEntities.clear();
      const paneIdClr = (_ctxClear && _ctxClear.paneId) || 'main';
      document.querySelectorAll(`.db-bulk-edit-bar[data-pane-id="${paneIdClr}"], .db-cell-bulk-bar[data-pane-id="${paneIdClr}"]`).forEach(existingBar => existingBar.remove());
    }
  ctx.dbPath = dbPath;
  ctx.entityPath = null;
  ctx.pivotData = null;
  ctx.smartDb = null;
  ctx.smartDbData = null;
  // グローバルstate同期（非スコープ化コードの互換性）
  if (syncGlobalState) {
    state.currentDbPath = dbPath;
    state.currentSmartDb = null;
    state.smartDbData = null;
    state.currentEntityPath = null;
    state.pivotData = null;
  }
  // スマートシートからの遷移時、smart-db-view の表示が残ると通常シートが見えなくなる。
  // pane-bridge の DB_SUB_VIEWS 切替が走らないケースに備えて明示的に隠す。
  if (!openOpts.skipGlobalUi) {
    const _smartDbViewEl = document.getElementById('smart-db-view');
    if (_smartDbViewEl && _smartDbViewEl.style.display !== 'none') {
      _smartDbViewEl.style.display = 'none';
    }
  }
  const dbLoadSeq = (ctx._dbLoadSeq || 0) + 1;
  ctx._dbLoadSeq = dbLoadSeq;
  const isStaleDbLoad = () => (typeof openOpts.isLegacyLoadCurrent === 'function' && !openOpts.isLegacyLoadCurrent())
    || !!ctx.destroyed
    || (ctx.generation || 0) !== loadGeneration
    || ctx._dbLoadSeq !== dbLoadSeq
    || ctx.dbPath !== dbPath
    // タブ切替中の非同期読込が完了しても、既に非表示・撤去されたシート面へ
    // 描画しない。preferActivePane は通常ペインのアクティブ先を確認しつつ、
    // 埋め込み/サブパネルの正当なツリー外描画先は維持する。
    || _resolveDatabasePaneContext(ctx, { preferActivePane: true }) !== ctx
    || (!_dbIsOffTreeRenderSurface(ctx) && !!ctx?.containerEl && !document.body.contains(ctx.containerEl))
    || (!_dbIsOffTreeRenderSurface(ctx) && !_normalizeDbRenderContext(ctx));
  const hadLocalViewConfigBeforeOpen = typeof _hasLocalDbViewConfigCache === 'function'
    ? _hasLocalDbViewConfigCache(dbPath)
    : true;
  if (!openOpts.skipSaveLastView) saveLastView({type:'pivot', dbPath});
  if (!openOpts.skipNavPush) {
    const _navEntry = {type:'pivot', path: dbPath};
    navPush(_navEntry);
  }
  if (!openOpts.skipRecent) addRecent(dbPath.split('/').pop() || '', dbPath, 'database');
  if (!openOpts.skipAutoVersion) startAutoVersion(dbPath, 'db');
  if (!openOpts.skipHistoryScope) {
    const historyScope = typeof _dbViewConfigHistoryScope === 'function'
      ? _dbViewConfigHistoryScope(dbPath)
      : 'db:' + (dbPath.split('/').pop() || dbPath);
    historySetScope(historyScope);
  }

  // フォルダツリーで対応するノードをハイライト
  if (!openOpts.skipHighlight) highlightOutlinerNode(dbPath);

  // DBフォルダ名をカテゴリ名として表示
  const dbName = dbPath.split('/').pop() || dbPath;
  if (!openOpts.skipGlobalUi) {
    const toolbarCategoryEl = document.getElementById('toolbar-category');
    if (toolbarCategoryEl) {
      toolbarCategoryEl.textContent = dbName;
      toolbarCategoryEl.title = 'ダブルクリックでシート名を変更';
      // 古いハンドラがある場合は除去してから貼り直す（新しい ctx をクロージャに反映するため）
      if (toolbarCategoryEl._dbRenameHandler) {
        toolbarCategoryEl.removeEventListener('dblclick', toolbarCategoryEl._dbRenameHandler);
      }
      toolbarCategoryEl.style.cursor = 'text';
      const renameHandler = () => {
        const curName = toolbarCategoryEl.textContent;
        const input = document.createElement('input');
        input.type = 'text'; input.value = curName;
        input.style.cssText = 'font-size:inherit;font-weight:inherit;color:var(--fg);background:var(--bg);border:1px solid var(--blue,#4a90d9);border-radius:3px;padding:0 4px;outline:none;width:' + Math.max(120, toolbarCategoryEl.offsetWidth) + 'px;';
        toolbarCategoryEl.textContent = '';
        toolbarCategoryEl.appendChild(input);
        input.focus(); input.select();
        const commit = async () => {
          const newName = input.value.trim() || curName;
          toolbarCategoryEl.textContent = newName;
          if (newName !== curName && state.currentDbPath) {
            try {
              const oldPath = state.currentDbPath;
              const res = await apiPost('/outliner/rename', { old_path: oldPath, new_name: newName, type: 'database' });
              const newPath = res?.new_path || oldPath.replace(/[^/]+$/, newName);
              if (typeof renameAppPathReferences === 'function') {
                renameAppPathReferences(oldPath, newPath, { label: newName, fileId: res?.file_id, type: 'database' });
              }
              if (typeof refreshOutliner === 'function') refreshOutliner();
              await selectDatabase(newPath, ctx, {
                silent: true,
                skipRecent: true,
                skipNavPush: true,
                skipSaveLastView: false,
              });
              showStatus('シート名を変更しました');
            } catch (err) { toolbarCategoryEl.textContent = curName; showStatus('名前変更失敗: ' + err.message, true); }
          }
        };
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { input.value = curName; input.blur(); } });
      };
      toolbarCategoryEl._dbRenameHandler = renameHandler;
      toolbarCategoryEl.addEventListener('dblclick', renameHandler);
    }
    window.MeldexFileLockBadge?.apply?.(toolbarCategoryEl, dbPath);
    const currentTitleEl = document.getElementById('current-title');
    if (currentTitleEl) currentTitleEl.textContent = dbName;
    const sbCategoryEl = document.getElementById('sb-category');
    if (sbCategoryEl) sbCategoryEl.textContent = 'シート: ' + dbName;
  }

  // 現在のシートビュータイプ復元（カレンダーDBは timeline=カレンダーモード）
  if (openOpts.restoreViewSnapshot) _restoreDbNavigationViewSnapshot(dbPath, openOpts.restoreViewSnapshot);
  if (Number.isInteger(openOpts.restoreViewIdx)) {
    const cfgForRestore = getDbViewConfig(dbPath);
    if (Array.isArray(cfgForRestore.savedViews) && openOpts.restoreViewIdx >= 0 && openOpts.restoreViewIdx < cfgForRestore.savedViews.length) {
      setCurrentViewIdx(dbPath, openOpts.restoreViewIdx, { skipHistory: true });
    }
  }
  let dbViewMode = requestedViewMode || getCurrentViewMode(dbPath, { ctx });
  ctx.viewMode = dbViewMode;
  if (!openOpts.skipShowView) showView(dbViewMode, ctx);

  // 非同期フェッチ中に前のシートの古いコンテンツが見えないよう、
  // サブビューの中身を即座にクリアする。renderXxx() が後で再描画する。
  if (!openOpts.silent && _isDbSwitch) {
    const _clearIds = ['gallery-view', 'kanban-view', 'chart-view', 'graph-view', 'form-view'];
    const _containerScope = ctx?.containerEl || null;
    for (const _cid of _clearIds) {
      const _cel = _containerScope
        ? (_containerScope.querySelector('#' + _cid) || _containerScope.querySelector('.' + _cid))
        : document.getElementById(_cid);
      if (_cel) _cel.innerHTML = '';
    }
  }

  // テーマ適用: クリア → DB自身のテーマ
  if (!openOpts.skipGlobalUi && typeof clearFileStyleForPanel === 'function') clearFileStyleForPanel('db-view-container');

  // DBメタデータ（actions/backlinks/theme）を取得
  ctx.dbMetadata = null;
  if (syncGlobalState) state.dbMetadata = null;
  const metadataPerfStartedAt = typeof _perfNowMs === 'function' ? _perfNowMs() : Date.now();
  try {
    const dbMetadata = await apiFetch('/db-metadata?path=' + encodeURIComponent(dbPath));
    if (isStaleDbLoad()) return completeLoad({ ok: false, stale: true, destroyed: !!ctx.destroyed });
    ctx.dbMetadata = dbMetadata;
    if (syncGlobalState) state.dbMetadata = dbMetadata;
    const backendViewConfig = ctx.dbMetadata?.view_config;
    let backendViewConfigApplied = false;
    if (_hasBackendDbViewConfigData(backendViewConfig)) {
      backendViewConfigApplied = _applyBackendDbViewConfig(dbPath, backendViewConfig, ctx);
    } else {
      const migratedViewConfig = await _migrateDbViewConfigToBackend(dbPath, {
        requireExistingLocalCache: true,
        hadLocalCache: hadLocalViewConfigBeforeOpen,
        ctx,
      });
      if (isStaleDbLoad()) return completeLoad({ ok: false, stale: true, destroyed: !!ctx.destroyed });
      if (migratedViewConfig && ctx.dbMetadata) ctx.dbMetadata.view_config = migratedViewConfig;
    }
    if (backendViewConfigApplied) {
      if (openOpts.restoreViewSnapshot) _restoreDbNavigationViewSnapshot(dbPath, openOpts.restoreViewSnapshot);
      const latestMode = requestedViewMode || getCurrentViewMode(dbPath, { ctx });
      if (latestMode && latestMode !== dbViewMode) {
        dbViewMode = latestMode;
        ctx.viewMode = dbViewMode;
        if (!openOpts.skipShowView) showView(dbViewMode, ctx);
      }
    }
    // DB自身のスタイル（style: 優先、旧 theme: も後方互換で読む）は DB パネルにのみ適用
    const _dbStyle = ctx.dbMetadata && (ctx.dbMetadata.style || ctx.dbMetadata.theme);
    if (!openOpts.skipGlobalUi && _dbStyle && typeof applyFileStyleToPanel === 'function') {
      applyFileStyleToPanel(_dbStyle, 'db-view-container');
    }
    if (typeof _logPerfEvent === 'function') {
      _logPerfEvent('sheet.metadata.total', metadataPerfStartedAt, {
        targetLabel: dbPerfTargetLabel,
        hasBackendViewConfig: !!_hasBackendDbViewConfigData(backendViewConfig),
      });
    }
  } catch {
    if (isStaleDbLoad()) return completeLoad({ ok: false, stale: true, destroyed: !!ctx.destroyed });
    const emptyMetadata = { actions: [], backlinks: [], style: null, theme: null, property_types: null, property_layout: null, property_layout_templates: [], publish: null, calendar_mapping: null, view_config: null };
    ctx.dbMetadata = emptyMetadata;
    if (syncGlobalState) state.dbMetadata = emptyMetadata;
    if (typeof _logPerfEvent === 'function') {
      _logPerfEvent('sheet.metadata.error', metadataPerfStartedAt, { targetLabel: dbPerfTargetLabel });
    }
  }

  // localStorage → バックエンドへの自動マイグレーション（property_types）
  // バックエンドの property_types が未設定（undefined/null）かつ localStorage に設定がある場合のみ
  if (ctx.dbMetadata && ctx.dbMetadata.property_types != null && Object.keys(ctx.dbMetadata.property_types).length === 0) {
    const localPt = getDbViewConfig(dbPath).propertyTypes;
    if (localPt && Object.keys(localPt).length > 0) {
      ctx.dbMetadata.property_types = localPt;
      if (!(typeof isProductionManagementWriteBlocked === 'function'
          && isProductionManagementWriteBlocked(dbPath, ctx))) _savePropertyTypesToBackend(dbPath, undefined, ctx);
    }
  }

  const pivotPerfStartedAt = typeof _perfNowMs === 'function' ? _perfNowMs() : Date.now();
  try {
    const activeViewForFilter = typeof getCurrentDbViewConfigEntry === 'function'
      ? getCurrentDbViewConfigEntry(dbPath, { ctx })
      : null;
    if (activeViewForFilter && Object.prototype.hasOwnProperty.call(activeViewForFilter, 'filter')) {
      // 対象シートの保存済みビュー設定にフィルタがあれば、それを常に優先する。
      ctx.filter = activeViewForFilter.filter || 'disabled';
    } else if (_isDbSwitch) {
      // 別シートへの切替では前シートの ctx.filter / state.filter を継承しない。
      // 保存済みビュー設定にフィルタが無いシートへ切り替えた場合はフィルタ無しへ落とす
      // （前シートのフィルタが残ると status_filter が誤って適用される回帰防止）。
      ctx.filter = 'disabled';
    } else {
      // 同一シートの再描画（forceReload 等）では、直前にユーザーが選んだフィルタを維持する。
      ctx.filter = ctx.filter || (syncGlobalState ? state.filter : '') || 'disabled';
    }
    if (syncGlobalState) state.filter = ctx.filter;
    const filterParam = getFilterParam(ctx.filter);
    const url = '/pivot?path=' + encodeURIComponent(dbPath) + (filterParam ? '&status_filter=' + filterParam : '');
    const pivotData = await apiFetch(url);
    if (isStaleDbLoad()) return completeLoad({ ok: false, stale: true, destroyed: !!ctx.destroyed });
    if (typeof _stampPivotValueEntityPaths === 'function') _stampPivotValueEntityPaths(dbPath, pivotData);
    if (window.GbDbEntryIdentity) window.GbDbEntryIdentity.registerPivot(dbPath, pivotData);
    ctx.pivotData = pivotData;
    if (syncGlobalState) state.pivotData = ctx.pivotData; // グローバル同期
    const entityCountForPerf = Object.keys(ctx.pivotData.entities || {}).length;
    const propertyCountForPerf = Array.isArray(ctx.pivotData.properties) ? ctx.pivotData.properties.length : 0;
    if (typeof _logPerfEvent === 'function') {
      _logPerfEvent('sheet.pivot.total', pivotPerfStartedAt, {
        targetLabel: dbPerfTargetLabel,
        entityCount: entityCountForPerf,
        propertyCount: propertyCountForPerf,
        backendPerf: ctx.pivotData?._backendPerf || null,
      });
    }
    if (typeof _preloadRelationMapsForDb === 'function') {
      // 先読みで参照先シートの欠落（リンク切れ）が判明した後、列見出しの警告アイコンを反映する。
      // 初回コールドロードは先読み完了後に付き、2回目以降はキャッシュ済みで renderPivot 直後に即出る。
      _preloadRelationMapsForDb(dbPath, ctx.pivotData, ctx)
        .then(() => { if (!isStaleDbLoad() && typeof _syncRelationWarningIcons === 'function') _syncRelationWarningIcons(ctx); })
        .catch(() => {});
    }
    const latestDbViewMode = getCurrentViewMode(dbPath);
    const effectiveLatestDbViewMode = requestedViewMode || getCurrentViewMode(dbPath, { ctx }) || latestDbViewMode;
    // 互換テスト用: if (latestDbViewMode && latestDbViewMode !== dbViewMode) {
    if (effectiveLatestDbViewMode && effectiveLatestDbViewMode !== dbViewMode) {
      // 互換テスト用: dbViewMode = latestDbViewMode;
      dbViewMode = effectiveLatestDbViewMode;
      ctx.viewMode = dbViewMode;
      if (!openOpts.skipShowView) showView(dbViewMode, ctx);
    }
    // カレンダーDBは初回表示時にカレンダービューに自動切替
    if (!requestedViewMode && ctx.pivotData.calendar_db && dbViewMode === 'pivot') {
      dbViewMode = 'calendar';
      ctx.viewMode = dbViewMode;
      const calendarCfg = getDbViewConfig(dbPath);
      const calendarView = typeof _getCurrentDbViewConfigEntryFromConfig === 'function'
        ? _getCurrentDbViewConfigEntryFromConfig(calendarCfg, { ctx })
        : null;
      if (calendarView && calendarView.viewMode !== 'calendar') {
        calendarView.viewMode = 'calendar';
        saveDbViewConfig(dbPath, calendarCfg, { skipHistory: true });
      }
      if (!openOpts.skipShowView) showView('timeline', ctx);
    }
    const entityCountForLoading = Object.keys(ctx.pivotData.entities || {}).length;
    if (showOpenLoading && typeof showLoadingBeforeHeavyWork === 'function') {
      await showLoadingBeforeHeavyWork(entityCountForLoading, '大きいシートを描画中...', { threshold: 250 });
      if (isStaleDbLoad()) return completeLoad({ ok: false, stale: true, destroyed: !!ctx.destroyed });
    }
    _renderDbViewTabsSafely(ctx);
    const hasDbViews = getSavedViews(dbPath).length > 0;
    const renderPerfStartedAt = typeof _perfNowMs === 'function' ? _perfNowMs() : Date.now();
    let renderedViewMode = dbViewMode;
    if (!hasDbViews && typeof renderDbNoViewsGuide === 'function') renderDbNoViewsGuide(ctx);
    else if (dbViewMode === 'tree' && typeof renderDbTreeView === 'function') renderDbTreeView(ctx);
    else if (dbViewMode === 'gallery') renderGallery(ctx);
    else if (dbViewMode === 'kanban') renderKanban(ctx);
    else if (dbViewMode === 'timeline' || dbViewMode === 'calendar' || dbViewMode === 'tasks' || dbViewMode === 'shifts') renderTimeline(ctx);
    else if (dbViewMode === 'chart' && typeof renderChart === 'function') renderChart(ctx);
    else if (dbViewMode === 'graph' && typeof renderGraph === 'function') renderGraph(ctx);
    else if (dbViewMode === 'form' && typeof renderDbFormView === 'function') renderDbFormView(ctx);
    else { renderedViewMode = 'pivot'; renderPivot(ctx); }
    if (typeof _logPerfEvent === 'function') {
      _logPerfEvent('sheet.render.dispatch', renderPerfStartedAt, {
        targetLabel: dbPerfTargetLabel,
        viewMode: renderedViewMode,
        entityCount: entityCountForPerf,
        propertyCount: propertyCountForPerf,
      });
    }
    _restoreDbViewScrollState(ctx, dbViewMode, openOpts.restoreScrollState);

    const entityNames = Object.keys(ctx.pivotData.entities || {}).sort();
    if (!openOpts.skipGlobalUi) showStatus(`${entityNames.length} 件のエントリ`);

    // マルチソースリレーション自動収集（fire-and-forget）
    if (hasDbViews && dbViewMode === 'pivot' && typeof _autoCollectAllMsrProps === 'function') {
      _autoCollectAllMsrProps(dbPath, ctx);
    }

    // テンプレートはメニュー/ツールバーから手動で適用
  } catch (e) {
    if (isStaleDbLoad()) return completeLoad({ ok: false, stale: true, destroyed: !!ctx.destroyed, error: e });
    ctx.dbPath = previousContext.dbPath;
    ctx.entityPath = previousContext.entityPath;
    ctx.pivotData = previousContext.pivotData;
    ctx.dbMetadata = previousContext.dbMetadata;
    ctx.viewMode = previousContext.viewMode;
    if (syncGlobalState && previousGlobal) {
      Object.assign(state, previousGlobal);
    }
    if (previousContext.pivotData) {
      _renderCurrentDbView(ctx, previousContext.dbPath);
    } else {
      _renderDbLoadError(ctx, e);
    }
    if (!openOpts.skipGlobalUi && typeof showStatus === 'function') {
      showStatus('シート読み込みエラー: ' + (e?.message || e), true);
    }
    return completeLoad({ ok: false, error: e });
  }
  if (!openOpts.skipGlobalUi) _syncDetailPanel(dbName, dbPath, 'database');
  // エンティティ追加/削除/リネーム後にリンク辞書を更新
  if (typeof MeldexAutoLink !== 'undefined') MeldexAutoLink.scheduleReload(3000);
  return completeLoad({ ok: true, stale: false, destroyed: false, dbPath });
  } finally {
    if (typeof _logPerfEvent === 'function') {
      const entityCount = Object.keys(ctx?.pivotData?.entities || {}).length;
      const propertyCount = Array.isArray(ctx?.pivotData?.properties) ? ctx.pivotData.properties.length : 0;
      _logPerfEvent('sheet.selectDatabase.total', dbPerfStartedAt, {
        targetLabel: dbPerfTargetLabel,
        viewMode: ctx?.viewMode || '',
        entityCount,
        propertyCount,
      });
    }
    if (loadingShown) {
      hideLoading();
      if (typeof hideLoadingMessage === 'function') {
        hideLoadingMessage('シートを読み込み中...');
        hideLoadingMessage('大きいシートを描画中...');
      }
    }
    if (ctx?._selectDatabaseInFlight?.promise === inFlightPromise) {
      delete ctx._selectDatabaseInFlight;
    }
    if (typeof resolveInFlightLoad === 'function') {
      resolveInFlightLoad(finalLoadResult || {
        ok: false,
        stale: true,
        destroyed: !!ctx?.destroyed,
        dbPath,
      });
    }
  }
}

async function selectEntity(entityPath, opts) {
  const openOpts = opts || {};
  const entityLoadSeq = (window._selectEntityLoadSeq || 0) + 1;
  window._selectEntityLoadSeq = entityLoadSeq;
  state.currentEntityPath = entityPath;
  // OptionTargetContext（計画書§11.1）: エントリ選択時に選択対象を更新する
  // （ファイル参照整合性計画 Phase 5、選択対象の取り違え解消の一環）。
  window.GBOptionTargetContext?.set({ path: entityPath, kind: 'entity' }, 'entity-select');
  if (!openOpts.skipStateView) state.view = 'entity';
  if (!openOpts.skipSaveLastView) saveLastView({type:'entity', entityPath});
  const _entityDisplayName = (entityPath.split('/').pop() || '').replace(/\.md$/, '');
  const currentTitleEl = document.getElementById('current-title');
  if (currentTitleEl && !openOpts.skipGlobalUi) currentTitleEl.textContent = _entityDisplayName;
  if (!openOpts.skipRecent) addRecent(_entityDisplayName, entityPath, 'entity');
  if (!openOpts.skipNavPush) {
    const _navEntry = {type:'entity', path: entityPath};
    navPush(_navEntry);
  }

  // フォルダツリーで対応するノードをハイライト
  if (!openOpts.skipHighlight) highlightOutlinerNode(entityPath);

  const entityFreeText = document.getElementById('entity-freetext');
  if (entityFreeText) entityFreeText.dataset.entityNoteCreated = '0';
  const entityRtToolbar = document.getElementById('entity-rt-toolbar');
  if (entityRtToolbar) entityRtToolbar.style.display = 'none';

  if (!openOpts.skipShowView) showView('entity');

  try {
    const data = await apiFetch('/entity?path=' + encodeURIComponent(entityPath));
    if (window._selectEntityLoadSeq !== entityLoadSeq || state.currentEntityPath !== entityPath) return;
    renderEntityPage(data);
    const entityName = _entityDisplayName;
    if (!openOpts.skipGlobalUi) {
      showStatus(`エントリ: ${entityName}`);
      _syncDetailPanel(entityName, entityPath, 'entity');
    }
  } catch (e) {
    // error shown by apiFetch
    if (state.currentEntityPath === entityPath) {
      state.currentEntityPath = null;
      // 読み込み失敗時は、まだこのエントリが選択対象のままなら取り消す
      // （後続の別選択で既に上書きされていれば触らない）。
      const failedTarget = window.GBOptionTargetContext?.get();
      if (failedTarget?.targets?.length === 1 && failedTarget.targets[0].path === entityPath) {
        window.GBOptionTargetContext.clear('entity-select-failed');
      }
    }
    if (state.view === 'entity' && !openOpts.skipShowView) showView('welcome');
  }
}


/* ==============================
   フィルタ
   ============================== */
function setFilter(f, options = {}) {
  const nextFilter = f || 'disabled';
  const ctx = options.ctx || null;
  const dbPath = options.dbPath || ctx?.dbPath || state.currentDbPath || '';
  if (ctx) ctx.filter = nextFilter;
  if (!ctx || dbPath === state.currentDbPath) state.filter = nextFilter;
  if (dbPath && typeof _saveCurrentDbViewField === 'function') {
    _saveCurrentDbViewField(dbPath, '', '', { skipHistory: true, ctx }, (v) => {
      v.filter = nextFilter;
    });
  }
  _updateFilterBadge({ dbPath, filter: nextFilter, ctx });
  if (!options.skipReload && dbPath) selectDatabase(dbPath, ctx || undefined);
}

function filterValues(values, status, filterMode) {
  if (!values) return [];
  // 第2引数 status 指定時は、その特定ステータスのみを返す（候補値書き換え時のガードレール用途）
  // status 未指定時は state.filter (adopted/nobotsu/all) に従ってステータスフィルタを適用
  if (status != null) {
    return values.filter(v => (v?.status || '採用') === status);
  }
  let result = values;
  const mode = filterMode == null ? state.filter : filterMode;
  // ステータスフィルタのみ適用（高度フィルタはプロパティ名が必要なためapplyAdvancedFiltersで適用）
  if (mode === 'adopted') result = result.filter(v => v.status === '採用' || v.status === '掲載済み');
  else if (mode === 'nobotsu') result = result.filter(v => v.status !== 'ボツ');
  return result;
}

// 候補値配列から「書き換え対象の採用値」を取得する標準ヘルパー。
// 候補値[0] を直接参照すると、先頭が案/ボツ候補だった場合にそれを破壊してしまうため、
// 候補値の書き換え前は必ず本関数で採用値を取得すること。
// 採用値が存在しない場合は null を返し、呼び出し側で新規追加（_apiPostValue）する責務。
function getAdoptedValueForWrite(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const adopted = [
    ...filterValues(values, '採用'),
    ...filterValues(values, '掲載済み'),
  ];
  return adopted.length ? adopted[0] : null;
}
window.getAdoptedValueForWrite = getAdoptedValueForWrite;

function getFilterParam(filterMode) {
  const mode = filterMode == null ? state.filter : filterMode;
  if (mode === 'adopted') return '採用,掲載済み';
  if (mode === 'nobotsu') return '採用,掲載済み,案';
  return '';
}

function _updateFilterBadge(options = {}) {
  const badge = document.getElementById('filter-badge');
  if (!badge) return;
  const dbPath = options.dbPath || state.currentDbPath;
  const filterMode = options.filter == null ? state.filter : options.filter;
  const advCount = dbPath ? (getAdvancedFilters(dbPath, { ctx: options.ctx || null }) || []).length : 0;
  const valueFilterCount = dbPath && typeof getColumnValueFilters === 'function'
    ? Object.keys(getColumnValueFilters(dbPath, { ctx: options.ctx || null }) || {}).length
    : 0;
  const statusLabel = filterMode === 'adopted' ? '採用のみ' : filterMode === 'nobotsu' ? 'ボツ非表示' : filterMode === 'all' ? '全表示' : '';
  const labels = [];
  if (statusLabel) labels.push(statusLabel);
  if (advCount) labels.push(advCount + '件');
  if (valueFilterCount) labels.push(valueFilterCount + '列');
  badge.textContent = labels.join(' + ');
  badge.style.display = labels.length ? '' : 'none';
}

/* 統合フィルタUI → gb-db-table.js に分離 */

/* ==============================
   ピボットテーブル描画
   ============================== */
function clearPivot(ctx) {
  ctx = _normalizeDbRenderContext(ctx);
  const tblId = ctx.tableId || 'pivot-table';
  const thead = _paneEl(ctx, '#' + tblId + ' thead');
  const tbody = _paneEl(ctx, '#' + tblId + ' tbody');
  const tfoot = _paneEl(ctx, '#' + tblId + ' tfoot');
  const table = _paneEl(ctx, '#' + tblId);
  if (typeof _dbDisconnectPinnedColumnTracking === 'function') {
    _dbDisconnectPinnedColumnTracking(table);
  } else {
    table?._dbPinnedWidthObserver?.disconnect?.();
    if (table) table._dbPinnedWidthObserver = null;
  }
  if (thead) thead.innerHTML = '';
  if (tbody) tbody.innerHTML = '';
  if (tfoot) tfoot.innerHTML = '';
  const countEl = _paneEl(ctx, '#sb-count') || (!ctx ? document.getElementById('sb-count') : null);
  if (countEl) countEl.textContent = '0 件';
}

/* PROP_TYPE_ICON → gb-db-props.js に分離 */

/* ==============================
   D-4-a: tbody click イベント委譲 (Phase 0 D-4)
   ============================== */

// 新規エントリ行クリック → 新規作成 + 即リネーム
/* ピボット描画・委譲処理 → gb-db-table.js に分離 */

/* ==============================
   Notion風インライン編集ヘルパー
   ============================== */

// ヘッダーのインラインリネーム
/* インライン編集・キーボードナビゲーション → gb-db-inline-edit.js に分離 */

function _dbScope(dbPathOverride) {
  const dbPath = dbPathOverride || state.currentDbPath;
  if (!dbPath) return '';
  if (typeof _dbViewConfigHistoryScope === 'function') {
    return _dbViewConfigHistoryScope(dbPath);
  }
  return 'db:' + String(dbPath).replace(/\\/g, '/');
}

function _dbResolveUndoDbPath(val, options = {}) {
  if (options.dbPath) return options.dbPath;
  const entityPath = options.entityPath
    || (typeof _resolveEntityPathFromValObj === 'function' ? _resolveEntityPathFromValObj(val) : '')
    || state.currentEntityPath
    || '';
  if (entityPath && typeof _dbPathFromEntityPath === 'function') {
    const dbPath = _dbPathFromEntityPath(entityPath);
    if (dbPath) return dbPath;
  }
  return state.currentDbPath || '';
}

function _dbResolveUndoCtx(dbPath, options = {}) {
  if (options.ctx) return options.ctx;
  if (dbPath && typeof _dbFindPaneContextForPath === 'function') return _dbFindPaneContextForPath(dbPath);
  return undefined;
}

function _dbUndoValue(label, val, oldValue, newValue, oldRichHtml, newRichHtml, options = {}) {
  const dbPath = _dbResolveUndoDbPath(val, options);
  const ctx = _dbResolveUndoCtx(dbPath, options);
  const scope = _dbScope(dbPath);
  const undoUpdates = { new_value: oldValue };
  const redoUpdates = { new_value: newValue };
  if (oldRichHtml !== undefined || newRichHtml !== undefined) {
    undoUpdates.new_rich_html = oldRichHtml || '';
    redoUpdates.new_rich_html = newRichHtml || '';
  }
  if (options.oldUpdates && typeof options.oldUpdates === 'object') Object.assign(undoUpdates, options.oldUpdates);
  if (options.newUpdates && typeof options.newUpdates === 'object') Object.assign(redoUpdates, options.newUpdates);
  historyPush(label,
    async () => { await _apiPutValue(val, undoUpdates); if (dbPath) await selectDatabase(dbPath, ctx, { silent: true }); },
    async () => { await _apiPutValue(val, redoUpdates); if (dbPath) await selectDatabase(dbPath, ctx, { silent: true }); },
    scope
  );
}
// ペアリレーション対応Undo（ペア側も自動で戻す）
function _dbUndoPairValue(label, val, oldValue, newValue, pairDbPath, targetId, pairProp, sourceId, wasAdding, oldTargetId, entityPath, cascadeClears, bidirectionalCtx, options = {}) {
  const dbPath = _dbResolveUndoDbPath(val, { ...options, entityPath });
  const ctx = _dbResolveUndoCtx(dbPath, options);
  const scope = _dbScope(dbPath);
  historyPush(label,
    async () => {
      await _apiPutValue(val, { new_value: oldValue });
      if (pairDbPath && pairProp && sourceId) {
        _relationCache[pairDbPath] = null;
        if (targetId) await _syncPairRelation(pairDbPath, targetId, pairProp, sourceId, !wasAdding);
        if (oldTargetId) await _syncPairRelation(pairDbPath, oldTargetId, pairProp, sourceId, true);
      }
      if (bidirectionalCtx && typeof _applyBidirectionalRelationSync === 'function') {
        await _applyBidirectionalRelationSync({
          sourceDbPath: dbPath,
          entityPath: bidirectionalCtx.entityPath,
          propName: bidirectionalCtx.propName,
          ptc: bidirectionalCtx.ptc,
          oldValue: newValue,
          newValue: oldValue,
        });
      }
      if (entityPath && cascadeClears?.length && typeof _restoreCascadeDependentValues === 'function') {
        await _restoreCascadeDependentValues(entityPath, cascadeClears, { dbPath, ctx });
      }
      if (dbPath) await selectDatabase(dbPath, ctx, { silent: true });
    },
    async () => {
      await _apiPutValue(val, { new_value: newValue });
      if (pairDbPath && pairProp && sourceId) {
        _relationCache[pairDbPath] = null;
        if (oldTargetId) await _syncPairRelation(pairDbPath, oldTargetId, pairProp, sourceId, false);
        if (targetId) await _syncPairRelation(pairDbPath, targetId, pairProp, sourceId, wasAdding);
      }
      if (bidirectionalCtx && typeof _applyBidirectionalRelationSync === 'function') {
        await _applyBidirectionalRelationSync({
          sourceDbPath: dbPath,
          entityPath: bidirectionalCtx.entityPath,
          propName: bidirectionalCtx.propName,
          ptc: bidirectionalCtx.ptc,
          oldValue,
          newValue,
        });
      }
      if (entityPath && cascadeClears?.length && typeof _redoCascadeDependentValues === 'function') {
        await _redoCascadeDependentValues(entityPath, cascadeClears, { dbPath, ctx });
      }
      if (dbPath) await selectDatabase(dbPath, ctx, { silent: true });
    },
    scope
  );
}

function _dbUndoStatus(val, oldStatus, newStatus, options = {}) {
  const dbPath = _dbResolveUndoDbPath(val, options);
  const ctx = _dbResolveUndoCtx(dbPath, options);
  const scope = _dbScope(dbPath);
  historyPush('ステータス: ' + oldStatus + ' → ' + newStatus,
    async () => { await _apiPutValue(val, { new_status: oldStatus }); if (dbPath) await selectDatabase(dbPath, ctx, { silent: true }); },
    async () => { await _apiPutValue(val, { new_status: newStatus }); if (dbPath) await selectDatabase(dbPath, ctx, { silent: true }); },
    scope
  );
}
function _dbUndoManualOrder(dbPath, movedNames, oldOrder, oldSortConfig, newOrder, ctx) {
  const scope = _dbScope(dbPath);
  // movedNames は配列。後方互換のため文字列が来た場合は配列に正規化
  const names = Array.isArray(movedNames) ? movedNames : [movedNames];
  const firstName = names[0];
  // sortConfig === null は「未設定（既定の名前順）」を意味する。Undo時はこれを忠実に復元する必要がある
  const apply = (order, sortConfig) => {
    const c = getDbViewConfig(dbPath);
    const view = typeof _getCurrentDbViewConfigEntryFromConfig === 'function'
      ? _getCurrentDbViewConfigEntryFromConfig(c, { ctx })
      : null;
    const target = view || c;
    if (order) target.manualOrder = [...order]; else delete target.manualOrder;
    if (sortConfig === null) delete target.sortConfig;
    else target.sortConfig = { ...sortConfig };
    saveDbViewConfig(dbPath, c);
    renderPivot(ctx);
  };
  const label = names.length > 1 ? `行移動: ${firstName} 他 ${names.length - 1} 件` : `行移動: ${firstName}`;
  historyPush(label,
    () => apply(oldOrder, oldSortConfig),
    () => apply(newOrder, { key: 'manual', dir: 'asc' }),
    scope
  );
}
// リネーム時に view config 内のエントリ名参照（manualOrder 等）を差し替える
// マニュアルソート中に旧名のままだと新名が manualOrder に存在せず末尾に落ちるため必須
function _dbRenameLocalRefs(dbPath, oldName, newName) {
  const c = getDbViewConfig(dbPath);
  let dirty = false;
  const update = (target) => {
    if (!target || !Array.isArray(target.manualOrder)) return;
    const idx = target.manualOrder.indexOf(oldName);
    if (idx >= 0) { target.manualOrder[idx] = newName; dirty = true; }
  };
  update(c);
  (c.savedViews || []).forEach(update);
  if (dirty) saveDbViewConfig(dbPath, c);
}
function _dbUndoRename(dbPath, oldName, newName, ctx) {
  const scope = _dbScope(dbPath);
  historyPush('名前を変更: ' + oldName + ' → ' + newName,
    async () => {
      await window.GbDbEntryIdentity.rename({ dbPath, oldName: newName, newName: oldName, ctx });
      await window.GbDbEntryIdentity.reload(ctx, dbPath);
    },
    async () => {
      await window.GbDbEntryIdentity.rename({ dbPath, oldName, newName, ctx });
      await window.GbDbEntryIdentity.reload(ctx, dbPath);
    },
    scope
  );
}

/* セル値D&D: エントリ名・候補値をドラッグして他ツールにリンク挿入
   D-9: 行生成ループ内 addEventListener 0 件にするため document 委譲に移行。
   per-element の addEventListener を廃し、data 属性で値を渡す。
*/
/* 値セルUI・ドロップダウン共通 → gb-db-cell-ui.js に分離 */

/* エントリページ描画 → gb-editor.js に移動 */

/* モーダル・メニュー系（値操作・エントリ操作・プロパティ操作） → gb-db-props.js に分離 */

/* 列設定・フィルタモーダル → gb-db-props.js に分離 */

/* プロパティ型システム → gb-db-property-types.js に分離 */

/* 条件付きカラー → gb-db-props.js に分離 */

/* 型別値エディタ・リレーション/選択ドロップダウン → gb-db-value-editors.js に分離 */


// ビュー管理・ギャラリー・カンバン・タイムラインは gb-db-views.js に分離

/* ==============================
   autoFill プレースホルダ評価（§15.4.2 / X4 確定）
   $today / $now / $currentUser / $version を実行時に評価。
   裸文字列は静的リテラルとして返す。
   ============================== */
function _resolveAutoFillPlaceholder(raw) {
  if (typeof raw !== 'string') return raw;
  if (!raw.startsWith('$')) return raw;
  const pad = n => String(n).padStart(2, '0');
  const d = new Date();
  const ymd = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  switch (raw) {
    case '$today':       return ymd;
    case '$now':         return `${ymd} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    case '$currentUser': return (typeof getUsername === 'function' ? getUsername() : '') || '';
    case '$version':     return (window.__meldexVersionCache && window.__meldexVersionCache.version) || '';
    default: return raw; // 未定義の $xxx は警告せず生のまま返す
  }
}

/* シート自動入力・変更ログ → gb-db-autofill.js に分離 */

/* 複数エントリの一括編集 → gb-db-bulk-edit.js に分離 */
