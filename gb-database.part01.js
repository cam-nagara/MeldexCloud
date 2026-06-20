/**
 * Meldex Database Views
 * DB/ピボット/ギャラリー/カンバン/タイムライン、数式、インライン編集
 */
/* 共通 helper は gb-db-core.js に分離 */

/* ==============================
   DB選択・エントリ選択
   ============================== */
function _resolveDatabasePaneContext(ctx, options) {
  const resolveOpts = options || {};
  const explicitCtx = !!ctx;
  let candidate = ctx || _currentPaneState();
  const paneMissing = !!(candidate?.paneId && typeof GBLayout !== 'undefined' && typeof GBLayout.findNode === 'function' && !GBLayout.findNode(GBLayout.root, candidate.paneId)?.node);
  const containerDetached = !!(candidate?.containerEl && !document.body.contains(candidate.containerEl));
  const shouldUseActivePane = !!resolveOpts.preferActivePane && !!candidate?.paneId && typeof GBLayout !== 'undefined' && !!GBLayout.activePane && candidate.paneId !== GBLayout.activePane;
  if (paneMissing || containerDetached || shouldUseActivePane) candidate = _currentPaneState();
  if (!explicitCtx && candidate?.containerEl && !_dbPaneHasPivotTable(candidate) && typeof _globalPaneState === 'function') {
    candidate = _globalPaneState();
  }
  return candidate;
}

function _dbPaneHasPivotTable(ctx) {
  if (!ctx?.containerEl) return true;
  const tblId = ctx.tableId || 'pivot-table';
  try {
    const id = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(tblId) : String(tblId).replace(/["\\]/g, '\\$&');
    return !!ctx.containerEl.querySelector('#' + id);
  } catch {
    return !!ctx.containerEl.querySelector('#' + tblId);
  }
}

function _normalizeDbRenderContext(ctx) {
  const candidate = ctx || _currentPaneState();
  if (candidate?.containerEl && !_dbPaneHasPivotTable(candidate) && typeof _globalPaneState === 'function') {
    return _globalPaneState();
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
  requestAnimationFrame(() => {
    const container = typeof _getDbViewScrollContainer === 'function'
      ? _getDbViewScrollContainer(ctx, viewMode)
      : null;
    if (!container) return;
    if (Number.isFinite(scrollState.scrollLeft)) container.scrollLeft = scrollState.scrollLeft;
    if (Number.isFinite(scrollState.scrollTop)) container.scrollTop = scrollState.scrollTop;
    const focusedEntity = String(scrollState.focusedEntity || '').trim();
    if (!focusedEntity) return;
    const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(focusedEntity) : focusedEntity.replace(/"/g, '\\"');
    const target = container.querySelector(`[data-entity-name="${escaped}"], [data-entity="${escaped}"]`)
      || document.querySelector(`[data-entity-name="${escaped}"], [data-entity="${escaped}"]`);
    if (!target) return;
    target.classList.add('db-view-focused-entity');
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    setTimeout(() => target.classList.remove('db-view-focused-entity'), 1600);
  });
}

function _renderDbLoadError(ctx, error) {
  ctx = _normalizeDbRenderContext(ctx);
  clearPivot(ctx);
  const message = 'シートを読み込めませんでした: ' + (error?.message || error || '不明なエラー');
  const safeMessage = typeof esc === 'function'
    ? esc(message)
    : String(message).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const tblId = ctx?.tableId || 'pivot-table';
  const tbody = _paneEl(ctx, '#' + tblId + ' tbody') || document.querySelector('#pivot-table tbody');
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="999" style="padding:24px;color:var(--fg2);">${safeMessage}</td></tr>`;
  }
  const errorHtml = `<div class="db-load-error" role="alert" style="padding:40px;text-align:center;color:var(--fg2);">${safeMessage}</div>`;
  ['.gallery-view', '.kanban-view', '.timeline-view', '.chart-view', '.graph-view', '.form-view'].forEach(selector => {
    const container = _paneEl(ctx, selector) || document.querySelector(selector);
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
    return { cfg: migrated.cfg || cloned, changed: migrated.changed === true };
  }
  return { cfg: cloned, changed: false };
}

function _applyBackendDbViewConfig(dbPath, viewConfig) {
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
    _persistDbViewConfigToBackend(dbPath, normalized);
  }
  return changed;
}

async function _migrateDbViewConfigToBackend(dbPath, options = {}) {
  if (!dbPath || typeof getDbViewConfig !== 'function' || typeof apiPut !== 'function') return null;
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
  const dbPerfStartedAt = typeof _perfNowMs === 'function' ? _perfNowMs() : Date.now();
  const dbPerfTargetLabel = String(dbPath || '').split(/[\\/]/).filter(Boolean).pop() || String(dbPath || '');
  ctx = _resolveDatabasePaneContext(ctx);
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
  const inFlightPromise = new Promise(resolve => { resolveInFlightLoad = resolve; });
  if (ctx) ctx._selectDatabaseInFlight = { dbPath, promise: inFlightPromise };
  if (!openOpts.skipShowView && typeof deactivateCsvSheetMode === 'function') deactivateCsvSheetMode();
  const showOpenLoading = !openOpts.silent
    && !openOpts.skipGlobalUi
    && typeof showLoading === 'function'
    && typeof hideLoading === 'function';
  let loadingShown = false;
  try {
    if (showOpenLoading) { showLoading('シートを読み込み中...'); loadingShown = true; }
    // 別DBへの切替時は一括編集バーを閉じる + 選択 Set をクリア (D-5)
    if (state.currentDbPath !== dbPath) {
      const _ctxClear = ctx || _currentPaneState();
      if (_ctxClear && _ctxClear._selectedEntities) _ctxClear._selectedEntities.clear();
      const paneIdClr = (_ctxClear && _ctxClear.paneId) || 'main';
      document.querySelectorAll(`.db-bulk-edit-bar[data-pane-id="${paneIdClr}"], .db-cell-bulk-bar[data-pane-id="${paneIdClr}"]`).forEach(existingBar => existingBar.remove());
    }
  ctx.dbPath = dbPath;
  ctx.entityPath = null;
  // グローバルstate同期（非スコープ化コードの互換性）
  state.currentDbPath = dbPath;
  state.currentSmartDb = null;
  state.smartDbData = null;
  state.currentEntityPath = null;
  // スマートシートからの遷移時、smart-db-view の表示が残ると通常シートが見えなくなる。
  // pane-bridge の DB_SUB_VIEWS 切替が走らないケースに備えて明示的に隠す。
  const _smartDbViewEl = document.getElementById('smart-db-view');
  if (_smartDbViewEl && _smartDbViewEl.style.display !== 'none') {
    _smartDbViewEl.style.display = 'none';
  }
  const dbLoadSeq = (ctx._dbLoadSeq || 0) + 1;
  ctx._dbLoadSeq = dbLoadSeq;
  const isStaleDbLoad = () => (typeof openOpts.isLegacyLoadCurrent === 'function' && !openOpts.isLegacyLoadCurrent())
    || ctx._dbLoadSeq !== dbLoadSeq
    || ctx.dbPath !== dbPath;
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
    const currentTitleEl = document.getElementById('current-title');
    if (currentTitleEl) currentTitleEl.textContent = dbName;
    const sbCategoryEl = document.getElementById('sb-category');
    if (sbCategoryEl) sbCategoryEl.textContent = 'シート: ' + dbName;
  }

  // 現在のシートビュータイプ復元（カレンダーDBは timeline=カレンダーモード）
  if (Number.isInteger(openOpts.restoreViewIdx)) {
    const cfgForRestore = getDbViewConfig(dbPath);
    if (Array.isArray(cfgForRestore.savedViews) && openOpts.restoreViewIdx >= 0 && openOpts.restoreViewIdx < cfgForRestore.savedViews.length) {
      setCurrentViewIdx(dbPath, openOpts.restoreViewIdx, { skipHistory: true });
    }
  }
  let dbViewMode = getCurrentViewMode(dbPath, { ctx });
  ctx.viewMode = dbViewMode;
  if (!openOpts.skipShowView) showView(dbViewMode, ctx);

  // テーマ適用: クリア → DB自身のテーマ
  if (!openOpts.skipGlobalUi && typeof clearFileStyleForPanel === 'function') clearFileStyleForPanel('db-view-container');

  // DBメタデータ（actions/backlinks/theme）を取得
  state.dbMetadata = null;
  const metadataPerfStartedAt = typeof _perfNowMs === 'function' ? _perfNowMs() : Date.now();
  try {
    const dbMetadata = await apiFetch('/db-metadata?path=' + encodeURIComponent(dbPath));
    if (isStaleDbLoad()) return;
    state.dbMetadata = dbMetadata;
    ctx.dbMetadata = dbMetadata;
    const backendViewConfig = state.dbMetadata?.view_config;
    let backendViewConfigApplied = false;
    if (_hasBackendDbViewConfigData(backendViewConfig)) {
      backendViewConfigApplied = _applyBackendDbViewConfig(dbPath, backendViewConfig);
    } else {
      const migratedViewConfig = await _migrateDbViewConfigToBackend(dbPath, {
        requireExistingLocalCache: true,
        hadLocalCache: hadLocalViewConfigBeforeOpen,
      });
      if (isStaleDbLoad()) return;
      if (migratedViewConfig && state.dbMetadata) state.dbMetadata.view_config = migratedViewConfig;
    }
    if (backendViewConfigApplied) {
      const latestMode = getCurrentViewMode(dbPath, { ctx });
      if (latestMode && latestMode !== dbViewMode) {
        dbViewMode = latestMode;
        ctx.viewMode = dbViewMode;
        if (!openOpts.skipShowView) showView(dbViewMode, ctx);
      }
    }
    // DB自身のスタイル（style: 優先、旧 theme: も後方互換で読む）は DB パネルにのみ適用
    const _dbStyle = state.dbMetadata && (state.dbMetadata.style || state.dbMetadata.theme);
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
    if (isStaleDbLoad()) return;
    state.dbMetadata = { actions: [], backlinks: [], style: null, theme: null, property_types: null, property_layout: null, property_layout_templates: [], publish: null, calendar_mapping: null, view_config: null };
    ctx.dbMetadata = state.dbMetadata;
    if (typeof _logPerfEvent === 'function') {
      _logPerfEvent('sheet.metadata.error', metadataPerfStartedAt, { targetLabel: dbPerfTargetLabel });
    }
  }

  // localStorage → バックエンドへの自動マイグレーション（property_types）
  // バックエンドの property_types が未設定（undefined/null）かつ localStorage に設定がある場合のみ
  if (state.dbMetadata && state.dbMetadata.property_types != null && Object.keys(state.dbMetadata.property_types).length === 0) {
    const localPt = getDbViewConfig(dbPath).propertyTypes;
    if (localPt && Object.keys(localPt).length > 0) {
      state.dbMetadata.property_types = localPt;
      _savePropertyTypesToBackend(dbPath);
    }
  }

  const pivotPerfStartedAt = typeof _perfNowMs === 'function' ? _perfNowMs() : Date.now();
  try {
    const activeViewForFilter = typeof getCurrentDbViewConfigEntry === 'function'
      ? getCurrentDbViewConfigEntry(dbPath, { ctx })
      : null;
    ctx.filter = activeViewForFilter && Object.prototype.hasOwnProperty.call(activeViewForFilter, 'filter')
      ? (activeViewForFilter.filter || 'disabled')
      : (ctx.filter || state.filter || 'disabled');
    state.filter = ctx.filter;
    const filterParam = getFilterParam(ctx.filter);
    const url = '/pivot?path=' + encodeURIComponent(dbPath) + (filterParam ? '&status_filter=' + filterParam : '');
    const pivotData = await apiFetch(url);
    if (isStaleDbLoad()) return;
    ctx.pivotData = pivotData;
    state.pivotData = ctx.pivotData; // グローバル同期
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
      _preloadRelationMapsForDb(dbPath, ctx.pivotData).catch(() => {});
    }
    const latestDbViewMode = getCurrentViewMode(dbPath);
    const effectiveLatestDbViewMode = getCurrentViewMode(dbPath, { ctx }) || latestDbViewMode;
    // 互換テスト用: if (latestDbViewMode && latestDbViewMode !== dbViewMode) {
    if (effectiveLatestDbViewMode && effectiveLatestDbViewMode !== dbViewMode) {
      // 互換テスト用: dbViewMode = latestDbViewMode;
      dbViewMode = effectiveLatestDbViewMode;
      ctx.viewMode = dbViewMode;
      if (!openOpts.skipShowView) showView(dbViewMode, ctx);
    }
    // カレンダーDBは初回表示時にカレンダービューに自動切替
    if (ctx.pivotData.calendar_db && dbViewMode === 'pivot') {
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
      if (isStaleDbLoad()) return;
    }
    _renderDbViewTabsSafely(ctx);
    const hasDbViews = getSavedViews(dbPath).length > 0;
    const renderPerfStartedAt = typeof _perfNowMs === 'function' ? _perfNowMs() : Date.now();
    let renderedViewMode = dbViewMode;
    if (!hasDbViews && typeof renderDbNoViewsGuide === 'function') renderDbNoViewsGuide(ctx);
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
    if (isStaleDbLoad()) return;
    ctx.pivotData = null;
    state.pivotData = null;
    state.dbMetadata = null;
    _renderDbLoadError(ctx, e);
    if (!openOpts.skipGlobalUi && typeof showStatus === 'function') {
      showStatus('シート読み込みエラー: ' + (e?.message || e), true);
    }
  }
  if (!openOpts.skipGlobalUi) _syncDetailPanel(dbName, dbPath, 'database');
  // エンティティ追加/削除/リネーム後にリンク辞書を更新
  if (typeof MeldexAutoLink !== 'undefined') MeldexAutoLink.scheduleReload(3000);
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
    if (loadingShown) hideLoading();
    if (ctx?._selectDatabaseInFlight?.promise === inFlightPromise) {
      delete ctx._selectDatabaseInFlight;
    }
    if (typeof resolveInFlightLoad === 'function') resolveInFlightLoad();
  }
}

async function selectEntity(entityPath, opts) {
  const openOpts = opts || {};
  const entityLoadSeq = (window._selectEntityLoadSeq || 0) + 1;
  window._selectEntityLoadSeq = entityLoadSeq;
  state.currentEntityPath = entityPath;
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
    if (state.currentEntityPath === entityPath) state.currentEntityPath = null;
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
  const statusLabel = filterMode === 'adopted' ? '採用のみ' : filterMode === 'nobotsu' ? 'ボツ非表示' : filterMode === 'all' ? '全表示' : '';
  const labels = [];
  if (statusLabel) labels.push(statusLabel);
  if (advCount) labels.push(advCount + '件');
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
  if (thead) thead.innerHTML = '';
  if (tbody) tbody.innerHTML = '';
  if (tfoot) tfoot.innerHTML = '';
  const countEl = _paneEl(ctx, '#sb-count') || document.getElementById('sb-count');
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
        await _restoreCascadeDependentValues(entityPath, cascadeClears);
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
        await _redoCascadeDependentValues(entityPath, cascadeClears);
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
    setTimeout(() => restoreActiveCellByEntityName(firstName), 50);
    // 移動した全エントリの選択状態を復元（D&D 直前のチェック状態を再現）
    _restoreSelectionByEntityNames(ctx, names);
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
  // 即時: 直前の rename 成功に追従して manualOrder 等を更新
  _dbRenameLocalRefs(dbPath, oldName, newName);
  if (typeof _dbNotifyCalendarEntryRenamed === 'function') {
    _dbNotifyCalendarEntryRenamed(dbPath, _entityPath(dbPath, oldName), _entityPath(dbPath, newName), oldName, newName);
  }
  historyPush('名前を変更: ' + oldName + ' → ' + newName,
    async () => {
      await apiPost('/entity/rename', { path: _entityPath(dbPath, newName), new_name: oldName });
      _dbRenameLocalRefs(dbPath, newName, oldName);
      if (typeof _dbNotifyCalendarEntryRenamed === 'function') {
        _dbNotifyCalendarEntryRenamed(dbPath, _entityPath(dbPath, newName), _entityPath(dbPath, oldName), newName, oldName);
      }
      await selectDatabase(dbPath, ctx, { silent: true });
    },
    async () => {
      await apiPost('/entity/rename', { path: _entityPath(dbPath, oldName), new_name: newName });
      _dbRenameLocalRefs(dbPath, oldName, newName);
      if (typeof _dbNotifyCalendarEntryRenamed === 'function') {
        _dbNotifyCalendarEntryRenamed(dbPath, _entityPath(dbPath, oldName), _entityPath(dbPath, newName), oldName, newName);
      }
      await selectDatabase(dbPath, ctx, { silent: true });
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

async function _autoRenameEntity(dbPath, entityName) {
  const newName = _generateEntryName(dbPath, entityName);
  if (!newName || newName === entityName) return;
  try {
    await apiPost('/entity/rename', { path: _entityPath(dbPath, entityName), new_name: newName });
  } catch { /* rename failed silently */ }
}


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
